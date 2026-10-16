/** A resident whose body would enclose the camera is not drawn for that frame
 * (a first-person eye inside a passer-by fills the view with one flat colour).
 * The body is a CAMERA_CLEARANCE-metre column from BODY_BELOW below the feet to
 * BODY_ABOVE above them. Mirrored by Core/NearCamera.cs. */
export const CAMERA_CLEARANCE = .8, BODY_BELOW = .3, BODY_ABOVE = 2.1;
export function clearsCamera(camera: { x: number; y: number; z: number }, feet: { x: number; y: number; z: number }): boolean {
  const dx = feet.x - camera.x, dz = feet.z - camera.z;
  return dx * dx + dz * dz >= CAMERA_CLEARANCE * CAMERA_CLEARANCE || camera.y < feet.y - BODY_BELOW || camera.y > feet.y + BODY_ABOVE;
}
