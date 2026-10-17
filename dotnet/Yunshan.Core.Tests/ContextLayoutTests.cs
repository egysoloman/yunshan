using Yunshan.Core.Host;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Same cases as tests/transit-label.test.ts and tests/place-services.test.ts.</summary>
public class ContextLayoutTests
{
    static Vec3 At(double x) => new Vec3(x, 0, 0);

    [Fact]
    public void StoppedVehicleWithinReachAndNearerThanDoorComesFirst()
    {
        var p = At(0);
        Assert.True(ContextLayout.StoppedVehicleFirst(p, "waiting", At(5), At(7)));
        Assert.True(ContextLayout.StoppedVehicleFirst(p, "boarding", At(5), null));
        Assert.False(ContextLayout.StoppedVehicleFirst(p, "moving", At(5), null));
        Assert.False(ContextLayout.StoppedVehicleFirst(p, "waiting", At(5), At(3)));
        Assert.False(ContextLayout.StoppedVehicleFirst(p, "waiting", At(ContextLayout.BoardingReach + .5), null));
    }

    [Fact]
    public void PlaceServicesSummaryMatchesWeb()
    {
        Assert.Equal("这里可办理：购餐 · 购餐并带 1 份 · 开始 60 分钟现场工班 · 商人考核", ContextLayout.PlaceServicesSummary(new[] { "购餐，吃 1 份 · 11.67 云币", "购餐并带 1 份 · 23.35 云币", "开始 60 分钟现场工班", "商人考核 · 80 云币" }));
        Assert.Equal("这里可办理：租住 · 床旁休息", ContextLayout.PlaceServicesSummary(new[] { "租住 · 80 云币", "床旁休息 · 20 分钟" }));
        Assert.Equal("这里可办理：a · b · c · d 等 5 项", ContextLayout.PlaceServicesSummary(new[] { "a", "b", "c", "d", "e", "a" }));
        Assert.Equal("这里可办理的事项", ContextLayout.PlaceServicesSummary(new string[0]));
    }

    [Fact]
    public void ServicesFoldOnlyOutsideWhenNoneIsUsable()
    {
        ContextSection Place(bool usable) => new ContextSection { Kind = "building", Actions = { new ContextAction { Label = "进入 / 使用建筑 · E", Client = "interact" }, new ContextAction { Label = "购餐", Disabled = !usable } } };
        Assert.True(ContextLayout.FoldsServices(Place(false), inside: false));
        Assert.False(ContextLayout.FoldsServices(Place(true), inside: false));
        Assert.False(ContextLayout.FoldsServices(Place(false), inside: true));
        Assert.False(ContextLayout.FoldsServices(new ContextSection { Kind = "vehicle", Actions = { new ContextAction { Label = "购票乘坐", Disabled = true } } }, inside: false));
    }
}
