using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Yunshan.Runtime
{
    /// <summary>Per-frame list of unit-cube instances (matrix + colour) drawn in
    /// batches of 1023 with Graphics.DrawMeshInstanced.</summary>
    public sealed class InstancedBoxes
    {
        const int Batch = 1023;
        static Mesh cube;
        readonly Material material;
        readonly List<Matrix4x4> matrices = new List<Matrix4x4>();
        readonly List<Vector4> colors = new List<Vector4>();
        readonly List<float> values = new List<float>();
        readonly float[] valueBatch = new float[Batch];
        readonly Mesh mesh; readonly string channel;
        readonly Matrix4x4[] matrixBatch = new Matrix4x4[Batch];
        readonly Vector4[] colorBatch = new Vector4[Batch];
        readonly MaterialPropertyBlock block = new MaterialPropertyBlock();
        public bool CastShadows = true;
        public int Count => matrices.Count;

        /// <param name="mesh">Defaults to a unit cube.</param>
        /// <param name="channel">Optional per-instance float property (for example a face style).</param>
        public InstancedBoxes(Material material, Mesh mesh = null, string channel = null) { this.material = material; this.mesh = mesh; this.channel = channel; material.enableInstancing = true; }

        /// <summary>Unit cube whose +Z face samples the right half of a face
        /// atlas cell (u toward the viewer's right, i.e. Unity −X after the
        /// mirror) and whose other faces sample the left (skin) half.</summary>
        public static Mesh FaceCube()
        {
            var vertices = new List<Vector3>(); var normals = new List<Vector3>(); var uvs = new List<Vector2>(); var triangles = new List<int>();
            void Face(Vector3 normal, Vector3 right, Vector3 up, bool face)
            {
                int i = vertices.Count; var c = normal * .5f;
                Vector3[] corners = { c - right * .5f - up * .5f, c + right * .5f - up * .5f, c + right * .5f + up * .5f, c - right * .5f + up * .5f };
                Vector2[] uv = { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) };
                for (int k = 0; k < 4; k++) { vertices.Add(corners[k]); normals.Add(normal); uvs.Add(new Vector2((face ? .5f : 0) + uv[k].x * .5f, uv[k].y)); }
                // Unity front faces are clockwise from outside, for which
                // Cross(b − a, c − a) points outward along the normal.
                if (Vector3.Dot(Vector3.Cross(corners[1] - corners[0], corners[2] - corners[0]), normal) > 0) { triangles.AddRange(new[] { i, i + 1, i + 2, i, i + 2, i + 3 }); }
                else { triangles.AddRange(new[] { i, i + 2, i + 1, i, i + 3, i + 2 }); }
            }
            Face(Vector3.forward, Vector3.left, Vector3.up, true);
            Face(Vector3.back, Vector3.right, Vector3.up, false);
            Face(Vector3.right, Vector3.forward, Vector3.up, false);
            Face(Vector3.left, Vector3.back, Vector3.up, false);
            Face(Vector3.up, Vector3.right, Vector3.forward, false);
            Face(Vector3.down, Vector3.right, Vector3.back, false);
            var mesh = new Mesh { name = "居民头部（面孔图集）" };
            mesh.SetVertices(vertices); mesh.SetNormals(normals); mesh.SetUVs(0, uvs); mesh.SetTriangles(triangles, 0); mesh.RecalculateBounds();
            return mesh;
        }

        public static Mesh Cube
        {
            get
            {
                if (cube != null) return cube;
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                cube = go.GetComponent<MeshFilter>().sharedMesh;
                Object.Destroy(go);
                return cube;
            }
        }

        public void Clear() { matrices.Clear(); colors.Clear(); values.Clear(); }
        public void Add(Matrix4x4 matrix, Color color, float value = 0) { matrices.Add(matrix); colors.Add(color); values.Add(value); }
        public void Add(Vector3 position, Quaternion rotation, Vector3 size, Color color, float value = 0) => Add(Matrix4x4.TRS(position, rotation, size), color, value);

        public void Draw()
        {
            for (int start = 0; start < matrices.Count; start += Batch)
            {
                int n = Mathf.Min(Batch, matrices.Count - start);
                matrices.CopyTo(start, matrixBatch, 0, n);
                colors.CopyTo(start, colorBatch, 0, n);
                block.SetVectorArray("_Color", colorBatch);
                if (channel != null) { values.CopyTo(start, valueBatch, 0, n); block.SetFloatArray(channel, valueBatch); }
                Graphics.DrawMeshInstanced(mesh != null ? mesh : Cube, 0, material, matrixBatch, n, block, CastShadows ? ShadowCastingMode.On : ShadowCastingMode.Off, true);
            }
        }
    }
}
