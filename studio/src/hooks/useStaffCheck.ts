import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export function useStaffCheck() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function check() {
      try {
        const { data, error } = await supabase.rpc('is_global_admin')
        if (error) throw error
        setIsStaff(!!data)
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
