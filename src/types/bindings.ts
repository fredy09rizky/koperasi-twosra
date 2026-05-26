// Type definitions untuk semua binding/env dan shape data inti backend.
// File lain mengimpor tipe ini agar route/helper berbicara dengan kontrak data yang sama.
export interface Bindings {
	DB: D1Database;
	IMG_BUCKET: R2Bucket;
	ASSETS: Fetcher;
	JWT_SECRET: string;
	PAKASIR_PROJECT_SLUG: string;
	PAKASIR_API_KEY: string;
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_CHAT_ID: string;
	TELEGRAM_TOPIC_ORDER: string;
	TELEGRAM_TOPIC_SECURITY: string;
	TELEGRAM_TOPIC_ADMIN: string;
	CORS_ALLOWED_ORIGINS?: string;
	ENVIRONMENT?: 'development' | 'production';
	RATE_LIMITER?: DurableObjectNamespace;
	IMAGE_OPTIMIZE_ALLOWED_DOMAINS?: string;
	INTERNAL_WEBHOOK_KEY?: string;
}

export interface JwtPayload {
	sub: string;
	role: string;
	sid?: string;
	exp: number;
	[key: string]: any; // Index signature untuk kompatibilitas dengan Hono JWT
}

export interface Product {
	id: number;
	code: string;
	name: string;
	price: number;
	category: string;
	image_url: string;
	stock: number;
	created_at: string;
}

export interface Order {
	id: string;
	customer_name: string;
	customer_class: string;
	wa_number: string;
	pickup_time: string;
	total_amount: number;
	fee: number;
	payment_status: string;
	pickup_status: string;
	picked_up_at?: string | null;
	created_at: string;
}

export interface OrderItem {
	id: number;
	order_id: string;
	product_name: string;
	product_code_snapshot?: string;
	quantity: number;
	price_at_purchase: number;
}

export interface AdminUser {
	id: number;
	username: string;
	password_hash: string;
	active_session_id?: string | null;
	session_last_login_ip?: string | null;
	session_last_login_device?: string | null;
	session_last_login_at?: string | null;
	created_at: string;
}

export interface CheckoutSession {
	checkout_token: string;
	order_id: string;
	amount: number;
	status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
	payment_started_at?: string | null;
	gateway_expires_at?: string | null;
	gateway_status?: string | null;
	gateway_total_payment?: number | null;
	gateway_fee?: number | null;
	gateway_payment_number?: string | null;
	created_at: string;
	expires_at: string;
}

export interface StockReservation {
	id: number;
	checkout_token: string;
	order_id: string;
	product_id?: number | null;
	product_code: string;
	quantity: number;
	status: 'RESERVED' | 'RELEASED' | 'CONSUMED';
	expires_at: string;
	release_reason?: string | null;
	released_at?: string | null;
	consumed_at?: string | null;
	created_at: string;
}

export interface StoreStatusRecord {
	accepting_orders: boolean;
	updated_at: string;
	updated_by: string | null;
}

export interface D1RunResult {
	success?: boolean;
	meta?: { changes?: number; last_row_id?: number };
}

export interface D1CountRow {
	total?: number;
	[key: string]: unknown;
}
