function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing ${name}. Copy admin/.env.example to admin/.env and fill it in.`);
  }
  return String(value).trim();
}

export const config = {
  apiUrl: required('VITE_API_URL').replace(/\/+$/, ''),
  firebase: {
    apiKey: required('VITE_FIREBASE_API_KEY'),
    authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: required('VITE_FIREBASE_PROJECT_ID'),
    appId: required('VITE_FIREBASE_APP_ID'),
  },
} as const;
