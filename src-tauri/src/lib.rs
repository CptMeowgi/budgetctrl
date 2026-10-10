use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Emitter, Manager, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;

/// Set just before `app.exit()` so the close-to-tray handler below stands aside
/// and lets a real quit through. Without this, "Quit" could be swallowed by
/// `prevent_close()` and the app would only be killable from Task Manager.
static QUITTING: AtomicBool = AtomicBool::new(false);

fn show_main(app: &tauri::AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

/// The address a reminder toast opens when clicked. Windows hands it to the
/// app - to the copy already running, via the single-instance plugin, or to a
/// fresh launch if the app was quit.
const DUE_SOON_LINK: &str = "budgetctrl://due-soon";

/// Set when a reminder was clicked before the page could hear about it - the
/// app was launched by the click - and taken by the page once it has loaded.
static OPEN_DUE_SOON: AtomicBool = AtomicBool::new(false);

fn open_due_soon(app: &tauri::AppHandle) {
  OPEN_DUE_SOON.store(true, Ordering::SeqCst);
  show_main(app);
  let _ = app.emit("open-due-soon", ());
}

fn is_due_soon_link(url: &str) -> bool {
  url.starts_with(DUE_SOON_LINK)
}

#[tauri::command]
fn take_open_due_soon() -> bool {
  OPEN_DUE_SOON.swap(false, Ordering::SeqCst)
}

/// Shows a reminder that opens the app when clicked. The notification
/// plugin's own toasts cannot do that on Windows: their click hook is
/// mobile-only, so a click did nothing and the toast sat in the
/// notification centre.
#[tauri::command]
fn show_reminder(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
  #[cfg(windows)]
  {
    toast::show(&app, &title, &body).map_err(|e| e.to_string())
  }
  #[cfg(not(windows))]
  {
    let _ = (app, title, body);
    Err("clickable reminders are Windows-only".into())
  }
}

#[cfg(windows)]
mod toast {
  use windows::{
    core::HSTRING,
    Data::Xml::Dom::XmlDocument,
    UI::Notifications::{ToastNotification, ToastNotificationManager},
  };

  /// A build run straight from target\ has no Start menu shortcut to carry the
  /// app's id, which Windows needs before it will show a toast. Like the
  /// notification plugin, borrow PowerShell's there.
  const POWERSHELL_APP_ID: &str =
    "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

  fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
      .replace('<', "&lt;")
      .replace('>', "&gt;")
      .replace('"', "&quot;")
      .replace('\'', "&apos;")
  }

  fn installed() -> bool {
    std::env::current_exe()
      .ok()
      .and_then(|exe| exe.parent().map(|d| d.display().to_string()))
      .map(|dir| !(dir.ends_with("\\target\\debug") || dir.ends_with("\\target\\release")))
      .unwrap_or(true)
  }

  pub fn show(app: &tauri::AppHandle, title: &str, body: &str) -> windows::core::Result<()> {
    let app_id = if installed() {
      app.config().identifier.clone()
    } else {
      POWERSHELL_APP_ID.to_string()
    };
    // Protocol activation rather than an in-process click handler: it works
    // from the notification centre long after the popup has gone, and even
    // when the app is no longer running.
    let xml = format!(
      "<toast activationType=\"protocol\" launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
      super::DUE_SOON_LINK,
      escape(title),
      escape(body)
    );
    let doc = XmlDocument::new()?;
    doc.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&doc)?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  // One copy only. Opening Budget Ctrl again - from the Start menu, or by
  // clicking a reminder - brings the running copy forward instead of starting
  // a second one. Two copies would each save the budget file over the other.
  // Must be the first plugin registered.
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if !argv.iter().any(|a| is_due_soon_link(a)) {
        show_main(app);
      }
    }));
  }

  builder
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_fs::init())
    // Restarts the app once an update has installed.
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // The installer registers budgetctrl:// for this copy; registering again
      // at each launch keeps it pointing here if the app has moved, and
      // covers builds run without an installer.
      #[cfg(desktop)]
      {
        let _ = app.deep_link().register_all();
        let handle = app.handle().clone();
        app.deep_link().on_open_url(move |event| {
          if event.urls().iter().any(|u| is_due_soon_link(u.as_str())) {
            open_due_soon(&handle);
          }
        });
        // Launched by the click itself: remember it for the page to pick up.
        if let Ok(Some(urls)) = app.deep_link().get_current() {
          if urls.iter().any(|u| is_due_soon_link(u.as_str())) {
            OPEN_DUE_SOON.store(true, Ordering::SeqCst);
          }
        }
      }

      // Updates are checked from the frontend, which asks before installing
      // anything. Every update must be signed with the key whose public half
      // is in tauri.conf.json, or it is refused.
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--hidden"]),
      ))?;

      let open_i = MenuItem::with_id(app, "open", "Open Budget Ctrl", true, None::<&str>)?;
      let sep = PredefinedMenuItem::separator(app)?;
      let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open_i, &sep, &quit_i])?;

      let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("Budget Ctrl")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "open" => show_main(app),
          "quit" => {
            QUITTING.store(true, Ordering::SeqCst);
            app.exit(0);
          }
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_main(tray.app_handle());
          }
        });

      // Fall back to a menu-only tray rather than panicking: `setup` runs with the
      // window still hidden, so a panic here would leave an invisible live process.
      if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
      }
      tray.build(app)?;

      // Autostart passes --hidden so login comes up silently in the tray.
      //
      // The window is configured visible and hidden here, rather than declared
      // hidden and shown here: if anything above this line fails, the window
      // still appears. The reverse would leave a live but invisible process
      // with no way to reach it except Task Manager.
      if std::env::args().any(|a| a == "--hidden") {
        if let Some(w) = app.get_webview_window("main") {
          let _ = w.hide();
        }
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![show_reminder, take_open_due_soon])
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        if QUITTING.load(Ordering::SeqCst) {
          return;
        }
        let _ = window.hide();
        api.prevent_close();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
