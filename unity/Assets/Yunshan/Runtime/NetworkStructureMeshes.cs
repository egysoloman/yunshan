using System;
using System.Collections.Generic;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>Builds the network's display boxes (Core/NetworkStructures,
    /// parity with the web renderer) into one mesh per 384 m cell, as the web
    /// BoxBatch does. Segments use three.js setFromUnitVectors (+Z onto the
    /// segment direction), so cross-sections roll exactly as on the web.</summary>
    public sealed class NetworkStructureMeshes : INetworkSink
    {
        const double Cell = 384;
        static readonly Dictionary<string, string> Palette = new Dictionary<string, string> { ["stone"] = "#a0ab9f", ["wood"] = "#73533b", ["roof"] = "#456760", ["amber"] = "#ffd39a", ["cyan"] = "#82d9d0" };
        readonly Dictionary<(long, long), GameMeshBuilder> cells = new Dictionary<(long, long), GameMeshBuilder>();
        readonly Dictionary<(long, long), GameMeshBuilder> glowCells = new Dictionary<(long, long), GameMeshBuilder>();

        GameMeshBuilder For(double x, double z, bool glow)
        {
            var key = ((long)Math.Floor(x / Cell), (long)Math.Floor(z / Cell)); var map = glow ? glowCells : cells;
            if (!map.TryGetValue(key, out var builder)) map[key] = builder = new GameMeshBuilder();
            return builder;
        }
        static Color ColorOf(string key, string color) => Space.Hex(color ?? Palette[key]);

        public void Box(string key, double x, double y, double z, double sx, double sy, double sz, string color = null, double rotation = 0, bool roof = false)
        {
            if (sx <= 0 || sy <= 0 || sz <= 0) return;
            For(x, z, key == "amber" || key == "cyan").LocalBox(GameMeshBuilder.GameFrame(x, y, z, rotation), -sx / 2, -sy / 2, -sz / 2, sx / 2, sy / 2, sz / 2, ColorOf(key, color), true);
        }

        public void Segment(string key, Vec3 a, Vec3 b, double width, double height, double lift = 0, string color = null)
        {
            double ax = a.X, ay = a.Y + lift, az = a.Z, bx = b.X, by = b.Y + lift, bz = b.Z;
            double dx = bx - ax, dy = by - ay, dz = bz - az, length = Math.Sqrt(dx * dx + dy * dy + dz * dz);
            if (length < .01) return;
            dx /= length; dy /= length; dz /= length;
            // THREE.Quaternion.setFromUnitVectors((0,0,1), d).
            double r = dz + 1, qx, qy, qz, qw;
            if (r < 1e-8) { qx = 0; qy = -1; qz = 0; qw = 0; } else { qx = -dy; qy = dx; qz = 0; qw = r; }
            double n = Math.Sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
            var rotation = new Quaternion((float)(qx / n), (float)(qy / n), (float)(qz / n), (float)(qw / n));
            var centre = new Vector3((float)((ax + bx) / 2), (float)((ay + by) / 2), (float)((az + bz) / 2));
            var frame = Matrix4x4.TRS(centre, rotation, Vector3.one);
            For(centre.x, centre.z, key == "amber" || key == "cyan").LocalBox(frame, -width / 2, -height / 2, -length / 2, width / 2, height / 2, length / 2, ColorOf(key, color), true);
        }

        /// <summary>Solid and glowing meshes per cell.</summary>
        public IEnumerable<(Mesh Mesh, bool Glow)> Build()
        {
            foreach (var pair in cells) yield return (pair.Value.Build($"路网结构 {pair.Key.Item1}:{pair.Key.Item2}"), false);
            foreach (var pair in glowCells) yield return (pair.Value.Build($"路网灯带 {pair.Key.Item1}:{pair.Key.Item2}"), true);
        }
    }
}
