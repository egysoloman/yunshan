using Xunit;

namespace Yunshan.Core.Tests;

public class CityMapImageTests
{
    [Fact]
    public void MapCoversTheCityAndRoundTripsCoordinates()
    {
        var world = World.CreateWorld();
        var image = CityMapImage.Render(world, 96);
        Assert.Equal(96 * 96 * 4, image.Pixels.Length);
        for (int k = 3; k < image.Pixels.Length; k += 4) Assert.Equal(255, image.Pixels[k]);
        foreach (var b in world.Buildings)
        {
            var (u, v) = image.Project(b.Position.X, b.Position.Z);
            Assert.InRange(u, 0, 1); Assert.InRange(v, 0, 1);
            var (x, z) = image.Unproject(u, v);
            Assert.Equal(b.Position.X, x, 6); Assert.Equal(b.Position.Z, z, 6);
        }
    }
}
