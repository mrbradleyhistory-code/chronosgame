import { useState } from 'react'
import { useStudent } from '../contexts/StudentContext'
import { PinInput } from './PinInput'

export function StudentLogin() {
  const { login } = useStudent()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pin.length < 4 || !username.trim()) return
    setError('')
    setLoading(true)
    const err = await login(username, pin)
    setLoading(false)
    if (err) {
      setError(err)
      setPin('')
    }
  }

  return (
    <div className="parchment-page">
      <div className="scroll-card">

        <div className="scroll-ornament top">
          <span className="ornament-symbol">⚔</span>
          <div className="ornament-line" />
          <span className="ornament-symbol">✦</span>
          <div className="ornament-line" />
          <span className="ornament-symbol">⚔</span>
        </div>

        <div className="scroll-body">
          <h1 className="scroll-title">CHRONOS</h1>
          <p className="scroll-subtitle">A Game of Civilizations</p>

          <div className="scroll-divider">
            <span>✦ Enter Your Realm ✦</span>
          </div>

          <form onSubmit={handleSubmit} className="scroll-form">
            <div className="form-group">
              <label className="parchment-label" htmlFor="civ-username">
                Login Name
              </label>
              <input
                id="civ-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. athens"
                required
                disabled={loading}
                className="parchment-input"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>

            <div className="form-group">
              <label className="parchment-label">Secret PIN</label>
              <PinInput value={pin} onChange={setPin} disabled={loading} />
            </div>

            {error && (
              <p className="parchment-error">⚠ {error}</p>
            )}

            <button
              type="submit"
              disabled={loading || pin.length < 4 || !username.trim()}
              className="parchment-btn"
            >
              {loading ? 'Consulting the Oracle…' : 'Enter the Realm'}
            </button>
          </form>
        </div>

        <div className="scroll-ornament bottom">
          <span className="ornament-symbol">⚔</span>
          <div className="ornament-line" />
          <span className="ornament-symbol">✦</span>
          <div className="ornament-line" />
          <span className="ornament-symbol">⚔</span>
        </div>

      </div>
    </div>
  )
}
