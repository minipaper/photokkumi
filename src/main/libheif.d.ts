// The part of libheif-js (Emscripten build of libheif, LGPL-3.0) that PhotoKkumi uses.
declare module 'libheif-js/wasm-bundle' {
  namespace libheif {
    interface HeifImage {
      handle: unknown
      get_width(): number
      get_height(): number
      is_primary(): boolean
      has_alpha_channel(): boolean
      display(target: { data: Uint8ClampedArray; width: number; height: number }, callback: (result: unknown) => void): void
      free(): void
    }
    class HeifDecoder {
      decoder: unknown
      decode(bytes: Uint8Array): HeifImage[]
    }
    function heif_context_free(context: unknown): void
    function _heif_image_handle_get_color_profile_type(handle: number): number
    function _heif_image_handle_get_raw_color_profile_size(handle: number): number
    function _heif_image_handle_get_raw_color_profile(error: number, handle: number, data: number): void
    function _malloc(size: number): number
    function _free(pointer: number): void
    const HEAPU8: Uint8Array
    const HEAP32: Int32Array
  }
  export default libheif
}
