/** Kullanıcıya gösterilebilir hata. `code`, locales/tr.ts içindeki errors.<code> anahtarıdır. */
export class AppError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
export const forbidden = () => new AppError("forbidden", 403);
export const notFound = () => new AppError("not_found", 404);
