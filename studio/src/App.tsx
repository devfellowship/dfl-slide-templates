import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { StaffRoute } from '@/components/StaffRoute'
import { AppShell } from '@/components/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { TemplateGallery } from '@/pages/TemplateGallery'
import { ThemesPage } from '@/pages/ThemesPage'

function ProtectedRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <StaffRoute>
      <AppShell />
    </StaffRoute>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoutes />}>
          <Route path="/templates" element={<TemplateGallery />} />
          <Route path="/themes" element={<ThemesPage />} />
          <Route path="/" element={<Navigate to="/templates" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
