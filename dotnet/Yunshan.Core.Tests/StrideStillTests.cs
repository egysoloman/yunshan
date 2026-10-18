using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Same cases as tests/stride-still.test.ts.</summary>
public class StrideStillTests
{
    [Fact]
    public void StoppedResidentStands()
    {
        Assert.True(CitizenAppearance.Striding(true, 10, 10.2));
        Assert.False(CitizenAppearance.Striding(true, 10, 10 + CitizenAppearance.StrideStillSeconds));
        Assert.False(CitizenAppearance.Striding(true, null, 10));
        Assert.False(CitizenAppearance.Striding(false, 10, 10));
        Assert.Equal(.5, CitizenAppearance.StrideStillSeconds);
    }
}
