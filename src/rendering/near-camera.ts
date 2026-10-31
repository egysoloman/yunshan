/** A resident whose body would enclose the camera is not drawn for that frame
 * (a first-person eye inside a passer-by fills the view with one flat colour).
 * The body is a CAMERA_CLEARANCE-metre column from BODY_BELOW below the feet to
 * BODY_ABOVE above them. Mirrored by Core/NearCamera.cs. */
export const CAMERA_CLEARANCE = .8, BODY_BELOW = .3, BODY_ABOVE = 2.1;
export function clearsCamera(camera: { x: number; y: number; z: number }, feet: { x: number; y: number; z: number }): boolean {
  const dx = feet.x - camera.x, dz = feet.z - camera.z;
  return dx * dx + dz * dz >= CAMERA_CLEARANCE * CAMERA_CLEARANCE || camera.y < feet.y - BODY_BELOW || camera.y > feet.y + BODY_ABOVE;
}

/** A vehicle whose body would enclose the camera (a van stopped where the
 * player stands) is not drawn that frame either: in the vehicle's own frame
 * the camera lies within its footprint (+VEHICLE_MARGIN) and between its floor
 * and VEHICLE_HEIGHT above it. `direction` turns the body's length onto +Z. */
export const VEHICLE_MARGIN = .3, VEHICLE_HEIGHT = 3.5;
export function vehicleClearsCamera(camera: { x: number; y: number; z: number }, position: { x: number; y: number; z: number }, direction: number, length: number, width: number, lift = 0): boolean {
  const dx = camera.x - position.x, dz = camera.z - position.z, c = Math.cos(direction), s = Math.sin(direction);
  const lx = dx * c - dz * s, lz = dx * s + dz * c, floor = position.y + lift;
  return Math.abs(lx) >= width / 2 + VEHICLE_MARGIN || Math.abs(lz) >= length / 2 + VEHICLE_MARGIN || camera.y < floor - VEHICLE_MARGIN || camera.y > floor + VEHICLE_HEIGHT;
}
