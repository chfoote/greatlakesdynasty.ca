import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignInForm from "../../components/auth/SignInForm";

export default function SignIn() {
  return (
    <>
      <PageMeta
        title="Sign In | Great Lakes Dynasty Hockey League"
        description="Sign in to the Great Lakes Dynasty Hockey League."
      />
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
}
