using System.IO.Compression;
using System.Text;
using Xunit;
using static Yunshan.Core.CanonicalJson;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/architecture-detail.ts: program-body facade details.</summary>
public class ArchitectureDetailParityTests
{
    [Fact]
    public void ProgramDetailsMatchTypeScript()
    {
        string expected;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "architecture-detail-v6.json.gz")))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) expected = reader.ReadToEnd();
        var world = World.CreateWorld();
        var program = world.Buildings.Where(b => ArchitectureFloorPlan.GetBuildingBody(b) != null).ToList();
        var kinds = new HashSet<string>();
        var sample = program.Where((b, i) => { bool first = kinds.Add(b.Kind); return first || i % 5 == 0; }).ToList();
        var rows = sample.SelectMany(b => new[] { 0.0, 2.0 }.Select(nearFloor => (object)new Obj().Put("id", b.Id).Put("nearFloor", nearFloor).Put("parts",
            ArchitectureDetail.ProgramDetails(b, nearFloor).Select(p =>
            {
                var o = new Obj().Put("purpose", p.Purpose).Put("position", Vec(p.Position)).Put("size", Vec(p.Size)).Put("color", p.Color).Put("floor", (double)p.Floor).Put("roof", p.Roof);
                if (p.Luminous) o.Put("luminous", true);
                return (object)o;
            }).ToList()))).ToList();
        var actual = Write(rows);
        if (expected != actual)
        {
            int i = 0; while (i < Math.Min(expected.Length, actual.Length) && expected[i] == actual[i]) i++;
            Assert.Fail($"details differ at {i}: expected …{expected.Substring(Math.Max(0, i - 200), Math.Min(400, expected.Length - Math.Max(0, i - 200)))}… actual …{actual.Substring(Math.Max(0, i - 200), Math.Min(400, actual.Length - Math.Max(0, i - 200)))}…");
        }
    }
}
