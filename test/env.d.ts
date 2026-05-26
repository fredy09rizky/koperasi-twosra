declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {
		INTERNAL_WEBHOOK_KEY: string;
	}
}
