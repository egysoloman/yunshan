using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Yunshan.Core;
using Yunshan.Core.Host;
using Yunshan.Runtime;

namespace Yunshan.Tests
{
    /// <summary>Editor checks for this machine (Window ▸ General ▸ Test
    /// Runner ▸ EditMode). They exercise what the container could not:
    /// Unity's own compiler and runtime, the local Node.js and the host.</summary>
    public class YunshanSmokeTests
    {
        static string Repository => Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));

        [Test]
        public void NodeAndSimulationHostAreFound()
        {
            var launch = HostLaunch.Resolve(Path.Combine(Application.streamingAssetsPath, "yunshan-sim"), Repository);
            Assert.NotNull(launch, "安装 Node.js 22+（或设置 YUNSHAN_NODE），并在仓库根目录 npm install。");
            Debug.Log("云山：" + launch.Description + " · " + launch.Node);
        }

        [Test, Timeout(300000)]
        public void HostOpensTheCityAndReturnsAFrame()
        {
            var launch = HostLaunch.Resolve(Path.Combine(Application.streamingAssetsPath, "yunshan-sim"), Repository);
            Assume.That(launch, Is.Not.Null);
            using (var client = launch.Start())
            {
                var opened = client.Open().GetAwaiter().GetResult();
                Assert.AreEqual(World.CurrentCityLayout, Json.Str(opened, "layout"));
                var frame = client.Step(.25, "walk", null, null, 260, 0).GetAwaiter().GetResult();
                Assert.AreEqual(1, frame.Ticks);
                Assert.IsTrue(frame.Vehicles.Count > 100);
                Assert.IsTrue(frame.Events.Any(e => e.Type == "arrival"));
            }
        }

        [Test]
        public void BuildingMeshesAreGeneratedFromTheSharedFloorPlans()
        {
            var world = World.CreateWorld();
            var building = world.Buildings.First(b => ArchitectureFloorPlan.GetBuildingBody(b) != null);
            var meshes = CityGeometry.NearBuilding(building, new System.Collections.Generic.Dictionary<string, StudioAssetBounds>());
            Assert.Greater(meshes.Solid.vertexCount, 100);
            var far = CityGeometry.FarBuildingMesh(building);
            Assert.Greater(far.vertexCount, 8);
        }

        [Test]
        public void FaceCubeFacesOutward()
        {
            var mesh = InstancedBoxes.FaceCube();
            var vertices = mesh.vertices; var triangles = mesh.triangles;
            for (int t = 0; t < triangles.Length; t += 3)
            {
                Vector3 a = vertices[triangles[t]], b = vertices[triangles[t + 1]], c = vertices[triangles[t + 2]];
                var centre = (a + b + c) / 3;
                Assert.Greater(Vector3.Dot(Vector3.Cross(b - a, c - a), centre), 0, "Unity front faces are clockwise from outside");
            }
        }

        [Test]
        public void ShadersShipUnderResources()
        {
            foreach (var name in new[] { "Yunshan/VertexColorLit", "Yunshan/InstancedColor", "Yunshan/CitizenFace", "Yunshan/Water", "Yunshan/UnlitColor" })
                Assert.NotNull(Shader.Find(name), name);
        }
    }
}
