use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager, WindowEvent,
};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

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
