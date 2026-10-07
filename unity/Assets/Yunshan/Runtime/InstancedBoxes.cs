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
        readonly Matrix4x4[] matrixBatch = new Matrix4x4[Batch];
        readonly Vector4[] colorBatch = new Vector4[Batch];
        readonly MaterialPropertyBlock block = new MaterialPropertyBlock();
        public bool CastShadows = true;
        public int Count => matrices.Count;

        public InstancedBoxes(Material material) { this.material = material; material.enableInstancing = true; }

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

        public void Clear() { matrices.Clear(); colors.Clear(); }
        public void Add(Matrix4x4 matrix, Color color) { matrices.Add(matrix); colors.Add(color); }
        public void Add(Vector3 position, Quaternion rotation, Vector3 size, Color color) => Add(Matrix4x4.TRS(position, rotation, size), color);

        public void Draw()
        {
            for (int start = 0; start < matrices.Count; start += Batch)
            {
                int n = Mathf.Min(Batch, matrices.Count - start);
                matrices.CopyTo(start, matrixBatch, 0, n);
                colors.CopyTo(start, colorBatch, 0, n);
                block.SetVectorArray("_Color", colorBatch);
                Graphics.DrawMeshInstanced(Cube, 0, material, matrixBatch, n, block, CastShadows ? ShadowCastingMode.On : ShadowCastingMode.Off, true);
            }
        }
    }
}
