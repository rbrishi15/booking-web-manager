import { AuthFrame } from "../_components/auth-frame";
import { RegisterForm } from "./register-form";

/** UC1-01 Register User. */
export default function RegisterPage() {
  return (
    <AuthFrame
      prompt="Already have an account?"
      switchLabel="Login"
      switchHref="/login"
    >
      <RegisterForm />
    </AuthFrame>
  );
}
