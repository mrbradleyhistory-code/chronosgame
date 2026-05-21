import { useAuth } from '../contexts/AuthContext'

export default function TeacherPage() {
  const { user, signInWithGoogle, signOut, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        <p>Loading...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-900 text-white">
        <h1 className="text-3xl font-bold">Chronos Game — Teacher Portal</h1>
        <p className="text-slate-400">Sign in with your Google account to manage games.</p>
        <button
          onClick={signInWithGoogle}
          className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold hover:bg-indigo-500 transition-colors"
        >
          Sign in with Google
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
        <h1 className="text-xl font-bold">Teacher Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">{user.email}</span>
          <button
            onClick={signOut}
            className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {['Games', 'Question Sets', 'Review Sessions'].map((section) => (
            <div key={section} className="rounded-xl border border-slate-700 bg-slate-800 p-6">
              <h2 className="mb-2 text-lg font-semibold">{section}</h2>
              <p className="text-sm text-slate-400">Placeholder — coming soon.</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
