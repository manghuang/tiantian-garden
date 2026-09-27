// GLTFLoader's ImageBitmapLoader fetches embedded GLB textures through blob URLs.
// img-src alone does not allow that fetch; connect-src must allow blob: too.
export const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
