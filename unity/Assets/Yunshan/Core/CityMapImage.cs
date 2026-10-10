// Top-down city map raster (engine-free): terrain relief, river, network and
// district markers, in the web minimap's orientation (+X right, +Z down).
using System;
using System.Collections.Generic;

namespace Yunshan.Core
{
    public sealed class CityMapImage
    {
        public readonly int Size;
        public readonly double MinX, MinZ, Span;
        /// <summary>RGBA, row 0 at the top (smallest Z).</summary>
        public readonly byte[] Pixels;

        CityMapImage(int size, double minX, double minZ, double span) { Size = size; MinX = minX; MinZ = minZ; Span = span; Pixels = new byte[size * size * 4]; }

        public (double u, double v) Project(double x, double z) => ((x - MinX) / Span, (z - MinZ) / Span);
        public (double x, double z) Unproject(double u, double v) => (MinX + u * Span, MinZ + v * Span);

        public static CityMapImage Render(WorldDefinition world, int size = 512)
        {
            double minX = double.PositiveInfinity, maxX = double.NegativeInfinity, minZ = double.PositiveInfinity, maxZ = double.NegativeInfinity;
            void Grow(double x, double z) { minX = Math.Min(minX, x); maxX = Math.Max(maxX, x); minZ = Math.Min(minZ, z); maxZ = Math.Max(maxZ, z); }
            foreach (var b in world.Buildings) Grow(b.Position.X, b.Position.Z);
            foreach (var n in world.Nodes) Grow(n.Position.X, n.Position.Z);
            foreach (var d in world.Districts) { Grow(d.Center.X - d.Radius, d.Center.Z - d.Radius); Grow(d.Center.X + d.Radius, d.Center.Z + d.Radius); }
            double span = Math.Max(maxX - minX, maxZ - minZ) * 1.08, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
            var image = new CityMapImage(size, cx - span / 2, cz - span / 2, span);
            double low = double.PositiveInfinity, high = double.NegativeInfinity;
            var heights = new double[size * size];
            for (int j = 0; j < size; j++) for (int i = 0; i < size; i++)
            {
                var (x, z) = image.Unproject((i + .5) / size, (j + .5) / size);
                double h = World.TerrainHeight(world, x, z, false);
                heights[j * size + i] = h; if (double.IsFinite(h)) { low = Math.Min(low, h); high = Math.Max(high, h); }
            }
            for (int j = 0; j < size; j++) for (int i = 0; i < size; i++)
            {
                double h = heights[j * size + i], t = double.IsFinite(h) && high > low ? (h - low) / (high - low) : 0;
                // Simple hill shading from the west neighbour.
                double west = i > 0 ? heights[j * size + i - 1] : h, shade = double.IsFinite(west) ? Math.Max(-.12, Math.Min(.12, (h - west) * .02)) : 0;
                double r = .80 - t * .32 + shade, g = .84 - t * .26 + shade, bl = .74 - t * .30 + shade;
                image.Set(i, j, r, g, bl);
            }
            image.Polyline(world.River, .41, .61, .62, 3);
            foreach (var e in world.Edges)
            {
                if (e.Mode == "flight") continue;
                bool rail = e.Mode == "maglev" || e.Mode == "lightRail";
                image.Polyline(e.Points, rail ? .36 : .45, rail ? .59 : .5, rail ? .55 : .43, rail ? 2 : 1);
            }
            foreach (var b in world.Buildings) { var (u, v) = image.Project(b.Position.X, b.Position.Z); image.Dot(u, v, 1, .55, .43, .32); }
            return image;
        }

        void Set(int i, int j, double r, double g, double b)
        {
            if (i < 0 || j < 0 || i >= Size || j >= Size) return;
            int k = (j * Size + i) * 4;
            Pixels[k] = (byte)Math.Max(0, Math.Min(255, r * 255)); Pixels[k + 1] = (byte)Math.Max(0, Math.Min(255, g * 255)); Pixels[k + 2] = (byte)Math.Max(0, Math.Min(255, b * 255)); Pixels[k + 3] = 255;
        }

        void Dot(double u, double v, int radius, double r, double g, double b)
        {
            int ci = (int)(u * Size), cj = (int)(v * Size);
            for (int dj = -radius; dj <= radius; dj++) for (int di = -radius; di <= radius; di++) if (di * di + dj * dj <= radius * radius) Set(ci + di, cj + dj, r, g, b);
        }

        void Polyline(IReadOnlyList<Vec3> points, double r, double g, double b, int width)
        {
            for (int p = 1; p < points.Count; p++)
            {
                var (u0, v0) = Project(points[p - 1].X, points[p - 1].Z); var (u1, v1) = Project(points[p].X, points[p].Z);
                double length = Math.Max(Math.Abs(u1 - u0), Math.Abs(v1 - v0)) * Size;
                int steps = Math.Max(1, (int)Math.Ceiling(length));
                for (int s = 0; s <= steps; s++) { double t = (double)s / steps; Dot(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, width / 2, r, g, b); }
            }
        }
    }
}
