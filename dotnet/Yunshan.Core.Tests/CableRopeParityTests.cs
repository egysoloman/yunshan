using System.IO.Compression;
using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/cable-rope.ts: current-v9's hung ropeway ropes and the grip arm of cabins under them.</summary>
public class CableRopeParityTests
{
    static string Gunzip(string name)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", name));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8); return reader.ReadToEnd();
    }

    [Fact]
    public void RopeLinesAndHeightsMatchTypeScript()
    {
        var world = Yunshan.Core.Host.WorldJson.FromJson((Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("world-current-v9.json.gz")));
        var want = (List<object>)Yunshan.Core.Host.Json.Parse(Gunzip("cable-rope-v9.json.gz"));
        Assert.Equal(2, want.Count);
        foreach (Dictionary<string, object> cable in want)
        {
            string id = (string)cable["id"]; var line = CableRope.Line(world, id)!; var expected = (List<object>)cable["line"];
            Assert.Equal(expected.Count, line.Count);
            for (int i = 0; i < line.Count; i++) { var row = (List<object>)expected[i]; Assert.Equal((double)row[0], line[i].X); Assert.Equal((double)row[1], line[i].Y); Assert.Equal((double)row[2], line[i].Z); }
            foreach (List<object> row in (List<object>)cable["heights"])
            {
                var p = new Vec3((double)row[0], (double)row[1], (double)row[2]); var h = CableRope.HeightAt(world, id, p)!.Value; var arm = CableRope.GripArm(7.85 - 1.5 / 2, p.Y, h);
                Assert.Equal((double)row[3], h); Assert.Equal((double)row[4], arm.Y); Assert.Equal((double)row[5], arm.Height);
            }
        }
        // Old layouts keep the rope along the path.
        var v6 = Yunshan.Core.Host.WorldJson.FromJson((Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("world-current-v6.json.gz")));
        Assert.Null(CableRope.Line(v6, v6.Edges.First(e => e.Mode == "cable").Id));
    }
}
