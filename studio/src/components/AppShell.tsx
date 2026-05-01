import { NavLink, Outlet } from 'react-router-dom'
import { LayoutTemplate, Palette } from 'lucide-react'

const navItems = [
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/themes', label: 'Themes', icon: Palette },
]

export function AppShell() {
  return (
    <div className="flex h-screen">
      <aside className="flex w-56 flex-col border-r border-border bg-sidebar">
        <div className="p-4">
          <h1 className="text-lg font-semibold text-sidebar-foreground">
            Template Studio
          </h1>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
