using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Yunshan.Runtime
{
    /// <summary>Accumulates coloured geometry in game (right-handed) space and
    /// emits a Unity mesh with X negated. A triangle counter-clockwise from
    /// outside in right-handed space becomes clockwise after the mirror, which
    /// is Unity's front face, so indices keep their order.</summary>
    public sealed class GameMeshBuilder
    {
        readonly List<Vector3> vertices = new List<Vector3>();
        readonly List<Vector3> normals = new List<Vector3>();
        readonly List<Color> colors = new List<Color>();
        readonly List<int> triangles = new List<int>();
        public int VertexCount => vertices.Count;

        public void Clear() { vertices.Clear(); normals.Clear(); colors.Clear(); triangles.Clear(); }

        /// <summary>Quad a-b-c-d counter-clockwise when seen from its front (game space).</summary>
        public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Color color)
        {
            var n = Vector3.Cross(b - a, c - a).normalized;
            int i = vertices.Count;
            vertices.Add(a); vertices.Add(b); vertices.Add(c); vertices.Add(d);
            for (int k = 0; k < 4; k++) { normals.Add(n); colors.Add(color); }
            triangles.Add(i); triangles.Add(i + 1); triangles.Add(i + 2);
            triangles.Add(i); triangles.Add(i + 2); triangles.Add(i + 3);
        }

        public void Triangle(Vector3 a, Vector3 b, Vector3 c, Color color)
        {
            var n = Vector3.Cross(b - a, c - a).normalized;
            int i = vertices.Count;
            vertices.Add(a); vertices.Add(b); vertices.Add(c);
            for (int k = 0; k < 3; k++) { normals.Add(n); colors.Add(color); }
            triangles.Add(i); triangles.Add(i + 1); triangles.Add(i + 2);
        }

        /// <summary>Quad oriented so its normal points away from <paramref name="inside"/>.</summary>
        public void QuadOutward(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 inside, Color color)
        {
            if (Vector3.Dot(Vector3.Cross(b - a, c - a), (a + b + c + d) / 4 - inside) >= 0) Quad(a, b, c, d, color); else Quad(d, c, b, a, color);
        }
        public void TriangleOutward(Vector3 a, Vector3 b, Vector3 c, Vector3 inside, Color color)
        {
            if (Vector3.Dot(Vector3.Cross(b - a, c - a), (a + b + c) / 3 - inside) >= 0) Triangle(a, b, c, color); else Triangle(c, b, a, color);
        }

        /// <summary>Axis-aligned box from min to max corners (game space).</summary>
        public void Box(double x0, double y0, double z0, double x1, double y1, double z1, Color color, bool bottom = false)
        {
            if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
            Vector3 p000 = V(x0, y0, z0), p100 = V(x1, y0, z0), p010 = V(x0, y1, z0), p110 = V(x1, y1, z0);
            Vector3 p001 = V(x0, y0, z1), p101 = V(x1, y0, z1), p011 = V(x0, y1, z1), p111 = V(x1, y1, z1);
            Quad(p001, p101, p111, p011, color); // +z
            Quad(p100, p000, p010, p110, color); // -z
            Quad(p101, p100, p110, p111, color); // +x
            Quad(p000, p001, p011, p010, color); // -x
            Quad(p011, p111, p110, p010, color); // +y
            if (bottom) Quad(p000, p100, p101, p001, color); // -y
        }

        /// <summary>Box given in a building's local frame, transformed to world.</summary>
        public void LocalBox(Matrix4x4 local, double x0, double y0, double z0, double x1, double y1, double z1, Color color, bool bottom = false)
        {
            if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
            Vector3 P(double x, double y, double z) => local.MultiplyPoint3x4(V(x, y, z));
            Vector3 p000 = P(x0, y0, z0), p100 = P(x1, y0, z0), p010 = P(x0, y1, z0), p110 = P(x1, y1, z0);
            Vector3 p001 = P(x0, y0, z1), p101 = P(x1, y0, z1), p011 = P(x0, y1, z1), p111 = P(x1, y1, z1);
            Quad(p001, p101, p111, p011, color);
            Quad(p100, p000, p010, p110, color);
            Quad(p101, p100, p110, p111, color);
            Quad(p000, p001, p011, p010, color);
            Quad(p011, p111, p110, p010, color);
            if (bottom) Quad(p000, p100, p101, p001, color);
        }

        static Vector3 V(double x, double y, double z) => new Vector3((float)x, (float)y, (float)z);

        /// <summary>Game-space right-handed transform: translate · rotateY(yaw).</summary>
        public static Matrix4x4 GameFrame(double x, double y, double z, double yaw)
        {
            float c = (float)System.Math.Cos(yaw), s = (float)System.Math.Sin(yaw);
            var m = Matrix4x4.identity;
            m.m00 = c; m.m02 = s; m.m20 = -s; m.m22 = c;
            m.m03 = (float)x; m.m13 = (float)y; m.m23 = (float)z;
            return m;
        }

        public Mesh Build(string name)
        {
            var mesh = new Mesh { name = name, indexFormat = vertices.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            var unityVertices = new Vector3[vertices.Count]; var unityNormals = new Vector3[normals.Count];
            for (int i = 0; i < vertices.Count; i++) { var v = vertices[i]; unityVertices[i] = new Vector3(-v.x, v.y, v.z); var n = normals[i]; unityNormals[i] = new Vector3(-n.x, n.y, n.z); }
            mesh.SetVertices(unityVertices); mesh.SetNormals(unityNormals); mesh.SetColors(colors); mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
