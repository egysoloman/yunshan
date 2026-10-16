namespace Yunshan.Core
{
    /// <summary>Port of src/rendering/near-camera.ts: a resident whose body
    /// (a Clearance-metre column from BodyBelow below to BodyAbove above the
    /// feet) would enclose the camera is not drawn for that frame.</summary>
    public static class NearCamera
    {
        public const double Clearance = .8, BodyBelow = .3, BodyAbove = 2.1;
        public static bool Clears(Vec3 camera, Vec3 feet)
        {
            double dx = feet.X - camera.X, dz = feet.Z - camera.Z;
            return dx * dx + dz * dz >= Clearance * Clearance || camera.Y < feet.Y - BodyBelow || camera.Y > feet.Y + BodyAbove;
        }
    }
}
