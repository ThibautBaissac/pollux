"use client";

import { createContext, useContext } from "react";

interface SidebarContextValue {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  toggle: () => {},
  close: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}
