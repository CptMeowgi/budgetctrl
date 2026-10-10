import { createContext } from "react";

// Two-step delete needs one armed id across the whole tree; passing it plus its
// setter into every row was two extra props on eight call sites.
export const DeleteArmContext = createContext({ armedId: null, arm: () => {} });
