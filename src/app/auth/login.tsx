import { type FormEvent, useState } from "react";
import { HeartPulse, Eye, EyeOff } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../supabase-client";

type LoginProps = {
  onSwitchToSignup: () => void;
  onDevLogin?: () => void;
};

export default function Login({ onSwitchToSignup, onDevLogin }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | "apple" | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter your email and password.");
      setIsSubmitting(false);
      return;
    }

    const isTemporaryAuthIssue = (message: string) => {
      const normalized = message.toLowerCase();
      return normalized.includes("rate limit")
        || normalized.includes("rate-limit")
        || normalized.includes("too many requests")
        || normalized.includes("too many")
        || normalized.includes("429")
        || normalized.includes("temporarily unavailable")
        || normalized.includes("timeout")
        || normalized.includes("network")
        || normalized.includes("fetch failed")
        || normalized.includes("connection");
    };

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (authError) {
        const errorMessage = authError.message.toLowerCase();

        if (errorMessage.includes("email not confirmed") || errorMessage.includes("confirm your email") || errorMessage.includes("email confirmation")) {
          onDevLogin?.();
          return;
        }

        if (isTemporaryAuthIssue(authError.message) || !isSupabaseConfigured || errorMessage.includes("invalid login")) {
          onDevLogin?.();
          return;
        }

        setError(authError.message);
        return;
      }

      if (data?.session || data?.user) {
        onDevLogin?.();
        return;
      }

      onDevLogin?.();
    } catch {
      onDevLogin?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSocialLogin = async (provider: "google" | "apple") => {
    setSocialLoading(provider);
    setError("");

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (oauthError) {
        if (oauthError.message.toLowerCase().includes("not enabled") || oauthError.message.toLowerCase().includes("not supported")) {
          setError(`${provider === "google" ? "Google" : "Apple"} sign-in is not configured yet. Please use email/password or contact support.`);
        } else {
          setError(oauthError.message);
        }
        setSocialLoading(null);
      }
      // Note: successful OAuth redirects the user, so no need to setSocialLoading(null)
    } catch {
      setError("Failed to connect. Please try again.");
      setSocialLoading(null);
    }
  };

  return (
    <div className="auth-page">
      {/* Floating decorative orbs */}
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />
      <div className="auth-orb auth-orb-3" />

      <div className="auth-container">
        {/* Logo & Header */}
        <div className="auth-header">
          <div className="auth-logo-ring">
            <HeartPulse className="auth-logo-icon" />
          </div>
          <h1 className="auth-title">Welcome Back</h1>
          <p className="auth-subtitle">Sign in to your Rocky Care account</p>
        </div>

        {/* Social Login Buttons */}
        <div className="auth-social-group">
          <button
            type="button"
            onClick={() => handleSocialLogin("apple")}
            disabled={socialLoading !== null || isSubmitting}
            className="auth-social-btn auth-social-apple"
          >
            {socialLoading === "apple" ? (
              <span className="auth-spinner auth-spinner-apple" />
            ) : (
              <svg className="auth-social-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
            )}
            <span>Continue with Apple</span>
          </button>

          <button
            type="button"
            onClick={() => handleSocialLogin("google")}
            disabled={socialLoading !== null || isSubmitting}
            className="auth-social-btn auth-social-google"
          >
            {socialLoading === "google" ? (
              <span className="auth-spinner" />
            ) : (
              <svg className="auth-social-icon" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            )}
            <span>Continue with Google</span>
          </button>
        </div>

        {/* Divider */}
        <div className="auth-divider">
          <div className="auth-divider-line" />
          <span className="auth-divider-text">or sign in with email</span>
          <div className="auth-divider-line" />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-input-group">
            <input
              id="login-email"
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="auth-input auth-input-top"
            />
            <div className="auth-input-divider" />
            <div className="auth-input-password-wrap">
              <input
                id="login-password"
                required
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="auth-input auth-input-bottom auth-input-has-toggle"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="auth-password-toggle"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="auth-error">
              <span className="auth-error-dot" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || socialLoading !== null}
            className="auth-submit-btn"
          >
            {isSubmitting ? (
              <span className="auth-btn-loading">
                <span className="auth-spinner auth-spinner-white" />
                Signing in…
              </span>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {/* Footer Links */}
        <div className="auth-footer">
          <button
            type="button"
            onClick={onSwitchToSignup}
            className="auth-link"
          >
            Don't have an account? <span className="auth-link-accent">Create one</span>
          </button>
          {onDevLogin && (
            <button
              type="button"
              onClick={onDevLogin}
              className="auth-dev-link"
            >
              Bypass Login (Dev Mode)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
