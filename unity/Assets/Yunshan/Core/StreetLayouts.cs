namespace Yunshan.Core
{
    /// <summary>Port of street-layouts.ts: layouts built with the R2 street recipe (current-v8 and its
    /// dense-market successor current-v9); display and terrain rules written for v8 apply to both.</summary>
    public static class StreetLayouts
    {
        public static bool IsStreetLayout(string layout) => layout == "current-v8" || layout == "current-v9";
        /// <summary>current-v9 only: the whole market district gathered into one dense shophouse town.</summary>
        public static bool IsDenseMarketLayout(string layout) => layout == "current-v9";
    }
}
