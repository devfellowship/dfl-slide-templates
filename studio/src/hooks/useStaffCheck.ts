import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const ALLOWED_ROLES = ['superadmin', 'admin']

export function useStaffCheck() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function check() {
      try {
        const { data, error } = await supabase.rpc('get_my_iam_role')
        if (error) throw error
        const roles: Array<{ role_id: string; level: number }> = data ?? []
        const allowed = roles.some(r => ALLOWED_ROLES.includes(r.role_id))
        setIsStaff(allowed)
      } catch {
        setIsStaff(false)
      } finally {
        setLoading(false)
      }
    }
    check()
  }, [])

  return { isStaff, loading }
}
