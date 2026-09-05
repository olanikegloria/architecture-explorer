import { login } from "../../api/auth/login";
import { AuthService } from "../../services/auth";

export default function LoginPage() {
  const auth = new AuthService();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await login({ email: "user@example.com", password: "secret" });
        auth.trackLogin();
      }}
    >
      <h1>Login</h1>
    </form>
  );
}
