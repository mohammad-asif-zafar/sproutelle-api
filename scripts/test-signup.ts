async function testAuth() {
  console.log("Testing Better Auth sign-up...");

  const testEmail = `testuser_${Date.now()}_${Math.floor(Math.random() * 1000)}@example.com`;
  const testPassword = "SecurePassword123!";
  const testName = "Test User";

  console.log(`Signing up user: ${testEmail}`);

  try {
    const res = await fetch("http://localhost:8788/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:5173",
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: testName,
      }),
    });

    const cookies = res.headers.get("set-cookie");
    const json = await res.json();

    console.log("Sign-up response status:", res.status);
    console.log("Sign-up response body:", JSON.stringify(json, null, 2));

    if (!res.ok) {
      console.error("Sign-up failed.");
      return;
    }

    console.log("Sign-up successful!");

    // Now read current user back using session cookie
    console.log("Reading current session/user back...");
    const sessionRes = await fetch("http://localhost:8788/api/auth/get-session", {
      method: "GET",
      headers: {
        "Origin": "http://localhost:5173",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    const sessionJson = await sessionRes.json();
    console.log("Session response status:", sessionRes.status);
    console.log("Session response body:", JSON.stringify(sessionJson, null, 2));

  } catch (err) {
    console.error("Error during auth test:", err);
  }
}

testAuth();
