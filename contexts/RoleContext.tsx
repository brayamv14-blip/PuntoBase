"use client";
import { createContext, useContext } from "react";
import type { Role } from "@/lib/permissions";

const RoleContext = createContext<Role>("employee"); // sin proveedor: lo mas restrictivo

export function RoleProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

export function useIsAdmin(): boolean {
  return useContext(RoleContext) === "admin";
}
