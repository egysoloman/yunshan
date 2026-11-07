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
    
        public const double VehicleMargin = .3, VehicleHeight = 3.5;

        /// <summary>Port of vehicleClearsCamera: a vehicle whose body would enclose the camera is not drawn that frame.</summary>
        public static bool VehicleClears(Vec3 camera, Vec3 position, double direction, double length, double width, double lift = 0)
        {
            double dx = camera.X - position.X, dz = camera.Z - position.Z, c = JsMath.Cos(direction), s = JsMath.Sin(direction);
            double lx = dx * c - dz * s, lz = dx * s + dz * c, floor = position.Y + lift;
            return System.Math.Abs(lx) >= width / 2 + VehicleMargin || System.Math.Abs(lz) >= length / 2 + VehicleMargin || camera.Y < floor - VehicleMargin || camera.Y > floor + VehicleHeight;
        }
    }
}
