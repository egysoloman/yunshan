// Port of src/geometry/upright-cylinder-sweep.ts.
using System;

namespace Yunshan.Core.Geometry
{
    public struct UprightCylinderBox
    {
        public double X0, X1, Z0, Z1, Bottom, Top;
        public UprightCylinderBox(double x0, double x1, double z0, double z1, double bottom, double top) { X0 = x0; X1 = x1; Z0 = z0; Z1 = z1; Bottom = bottom; Top = top; }
    }

    public static class UprightCylinderSweep
    {
        public const string Version = "upright-cylinder-sweep-v1";
        const double DistanceSquaredEpsilon = 1e-7;
        static bool Finite(double v) => !double.IsNaN(v) && !double.IsInfinity(v);
        static double Sq(double v) => v * v;

        static double PointRectDistanceSquared(double x, double z, in UprightCylinderBox box) =>
            Sq(JsMath.Max(JsMath.Max(box.X0 - x, 0), x - box.X1)) + Sq(JsMath.Max(JsMath.Max(box.Z0 - z, 0), z - box.Z1));

        static double PointSegmentDistanceSquared(double x, double z, Vec3 a, Vec3 b)
        {
            double dx = b.X - a.X, dz = b.Z - a.Z, squared = dx * dx + dz * dz;
            double t = squared == 0 ? 0 : JsMath.Max(0, JsMath.Min(1, ((x - a.X) * dx + (z - a.Z) * dz) / squared));
            return Sq(x - a.X - dx * t) + Sq(z - a.Z - dz * t);
        }

        static bool SegmentIntersectsRect(Vec3 a, Vec3 b, in UprightCylinderBox box)
        {
            double lo = 0, hi = 1;
            var axes = new[] { (a.X, b.X - a.X, box.X0, box.X1), (a.Z, b.Z - a.Z, box.Z0, box.Z1) };
            foreach (var (start, change, min, max) in axes)
            {
                if (change == 0) { if (start < min || start > max) return false; continue; }
                double u = (min - start) / change, v = (max - start) / change;
                lo = JsMath.Max(lo, JsMath.Min(u, v)); hi = JsMath.Min(hi, JsMath.Max(u, v));
                if (lo > hi) return false;
            }
            return true;
        }

        static Vec3 Interpolate(Vec3 a, Vec3 b, double t) => t == 0 ? a.Copy() : t == 1 ? b.Copy() : new Vec3(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t);

        public static bool Blocks(Vec3 from, Vec3 to, UprightCylinderBox box, double radius = .35, double height = 1.72, double footAllowance = 0)
        {
            foreach (var v in new[] { from.X, from.Y, from.Z, to.X, to.Y, to.Z, box.X0, box.X1, box.Z0, box.Z1, box.Bottom, box.Top, radius, height, footAllowance })
                if (!Finite(v)) throw new ArgumentOutOfRangeException(nameof(box), "Invalid upright cylinder or box geometry.");
            if (box.X0 > box.X1 || box.Z0 > box.Z1 || box.Bottom >= box.Top || !Finite(radius * radius) || radius * radius <= DistanceSquaredEpsilon || radius <= 0 || height <= 0 || footAllowance < 0
                || !Finite(Sq(to.X - from.X) + Sq(to.Z - from.Z)) || !Finite(to.Y - from.Y))
                throw new ArgumentOutOfRangeException(nameof(box), "Invalid upright cylinder or box geometry.");
            double lower = box.Bottom - height, upper = box.Top - footAllowance;
            if (lower >= upper) return false;
            double dy = to.Y - from.Y, lo = 0, hi = 1;
            if (dy == 0) { if (!(from.Y > lower && from.Y < upper)) return false; }
            else
            {
                double u = (lower - from.Y) / dy, v = (upper - from.Y) / dy;
                lo = JsMath.Max(0, JsMath.Min(u, v)); hi = JsMath.Min(1, JsMath.Max(u, v));
                if (!(lo < hi)) return false;
            }
            Vec3 a = Interpolate(from, to, lo), b = Interpolate(from, to, hi);
            double minimum = 0;
            if (!SegmentIntersectsRect(a, b, box))
            {
                minimum = JsMath.Min(PointRectDistanceSquared(a.X, a.Z, box), PointRectDistanceSquared(b.X, b.Z, box));
                foreach (var (x, z) in new[] { (box.X0, box.Z0), (box.X0, box.Z1), (box.X1, box.Z0), (box.X1, box.Z1) })
                    minimum = JsMath.Min(minimum, PointSegmentDistanceSquared(x, z, a, b));
            }
            return minimum < radius * radius - DistanceSquaredEpsilon;
        }
    }
}
