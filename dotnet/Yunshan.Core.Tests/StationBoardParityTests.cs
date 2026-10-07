using System.IO.Compression;
using System.Text;
using Xunit;
using Yunshan.Core.Host;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/station.ts: board placement and the live
/// print (connections, signal, nearby vehicles) for every station.</summary>
public class StationBoardParityTests
{
    static Dictionary<string, object> Fixture()
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "stations-v6.json.gz"));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        return (Dictionary<string, object>)Json.Parse(reader.ReadToEnd());
    }

    [Fact]
    public void BoardsMatchTheWebWayfinding()
    {
        var fixture = Fixture();
        var world = World.CreateWorld();
        var frame = SimFrame.From(fixture["frame"]);
        var stations = Json.Arr(fixture, "stations")!;
        Assert.Equal(world.Nodes.Count(n => n.Station), stations.Count);
        int withVehicles = 0;
        foreach (var s in stations)
        {
            var node = world.Nodes.Single(n => n.Id == Json.Str(s, "id"));
            var expected = Json.Obj(s, "view")!;
            var view = StationBoards.Describe(world, frame, node);
            Assert.Equal(Json.Str(expected, "name"), view.Name);
            Assert.Equal(Json.Str(expected, "district"), view.District);
            Assert.Equal(Json.Arr(expected, "connections")!.Cast<string>().ToList(), view.Connections);
            Assert.Equal(Json.Str(expected, "signal"), view.Signal);
            Assert.Equal((int)Json.Num(expected, "closed"), view.Closed);
            Assert.Equal((int)Json.Num(expected, "total"), view.Total);
            Assert.Equal((int)Json.Num(expected, "nearbyVehicles"), view.NearbyVehicles);
            if (view.NearbyVehicles > 0) withVehicles++;
            var boards = StationBoards.WallBoards(node);
            var expectedBoards = Json.Arr(s, "boards")!;
            Assert.Equal(expectedBoards.Count, boards.Count);
            for (int i = 0; i < boards.Count; i++)
            {
                var p = Json.Vec(Json.Obj(expectedBoards[i], "position"));
                Assert.Equal(p!.X, boards[i].Position.X); Assert.Equal(p.Y, boards[i].Position.Y); Assert.Equal(p.Z, boards[i].Position.Z);
                Assert.Equal(Json.Num(expectedBoards[i], "rotation"), boards[i].Rotation);
            }
        }
        Assert.True(withVehicles > 0, "the fixture exercises the nearby-vehicle count");
    }

    [Fact]
    public void AClosedEdgeLeavesTheConnectionsAndTurnsTheCount()
    {
        var world = World.CreateWorld();
        var node = world.Nodes.First(n => n.Station);
        var frame = new SimFrame();
        var before = StationBoards.Describe(world, frame, node);
        foreach (var e in world.Edges.Where(e => e.From == node.Id || e.To == node.Id)) frame.ClosedEdges.Add(e.Id);
        var after = StationBoards.Describe(world, frame, node);
        Assert.True(before.Total > 0);
        Assert.Equal(before.Total, after.Closed);
        Assert.Empty(after.Connections);
        Assert.Contains("暂无开放连接", StationBoards.Lines(after));
        Assert.NotEqual(before.Signature, after.Signature);
        Assert.Equal("信号未登记", after.Signal);
    }
}
