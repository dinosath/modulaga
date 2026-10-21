import { runtimeConfig } from "../runtime-config";

const ISSUER = (runtimeConfig.ferriskeyIssuer ?? import.meta.env.VITE_FERRISKEY_ISSUER)?.replace(/\/$/, "");
const CLIENT_ID = runtimeConfig.ferriskeyClientId ?? import.meta.env.VITE_FERRISKEY_CLIENT_ID;
const STORAGE_KEY = "modulaga.auth.access-token";
const TRANSACTION_KEY = "modulaga.auth.pkce";

type Discovery = { authorization_endpoint: string; token_endpoint: string };
type Transaction = { state: string; verifier: string; redirectUri: string };

export const authConfigured = Boolean(ISSUER && CLIENT_ID);
export const getAccessToken = () => sessionStorage.getItem(STORAGE_KEY) ?? undefined;

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomVerifier() {
  return base64Url(crypto.getRandomValues(new Uint8Array(48)));
}

async function discovery(): Promise<Discovery> {
  if (!ISSUER) throw new Error("Ferriskey issuer is not configured.");
  const response = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error("Ferriskey discovery is unavailable.");
  return await response.json() as Discovery;
}

export async function startSignIn() {
  if (!CLIENT_ID) throw new Error("Ferriskey client ID is not configured.");
  const metadata = await discovery();
  const state = randomVerifier();
  const verifier = randomVerifier();
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const transaction: Transaction = { state, verifier, redirectUri };
  sessionStorage.setItem(TRANSACTION_KEY, JSON.stringify(transaction));
  const authorize = new URL(metadata.authorization_endpoint);
  authorize.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email roles",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  window.location.assign(authorize);
}

export async function finishSignIn(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return false;
  const transactionRaw = sessionStorage.getItem(TRANSACTION_KEY);
  sessionStorage.removeItem(TRANSACTION_KEY);
  window.history.replaceState({}, "", `${url.pathname}${url.hash}`);
  if (!transactionRaw || !CLIENT_ID) throw new Error("Ferriskey sign-in state was lost. Start sign-in again.");
  const transaction = JSON.parse(transactionRaw) as Transaction;
  if (url.searchParams.get("state") !== transaction.state) throw new Error("Ferriskey sign-in state did not match.");
  const metadata = await discovery();
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: transaction.redirectUri,
      code_verifier: transaction.verifier,
    }),
  });
  if (!response.ok) throw new Error("Ferriskey could not exchange the sign-in code.");
  const tokens = await response.json() as { access_token?: string };
  if (!tokens.access_token) throw new Error("Ferriskey response did not include an access token.");
  sessionStorage.setItem(STORAGE_KEY, tokens.access_token);
  return true;
}

export function signOut() {
  sessionStorage.removeItem(STORAGE_KEY);
}
