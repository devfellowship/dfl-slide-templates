import type { ReactNode } from 'react'
import { useStaffCheck } from '@/hooks/useStaffCheck'

export function StaffRoute({ children }: { children: ReactNode }) {
  const { isStaff, loading } = useStaffCheck()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Checking permissions…</p>
      </div>
    )
  }

  if (!isStaff) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Staff Only</h1>
        <p className="text-muted-foreground">
          This tool is restricted to staff members.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
