// Built-in render pipeline: river, pools and falls. Lives under Resources so
// player builds include it for Shader.Find.
Shader "Yunshan/Water"
{
    Properties
    {
        _Color ("Colour", Color) = (0.31, 0.55, 0.58, 1)
        _Glossiness ("Smoothness", Range(0,1)) = 0.92
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        LOD 200
        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows
        #pragma target 3.0
        struct Input { float3 worldPos; };
        fixed4 _Color;
        half _Glossiness;
        void surf (Input IN, inout SurfaceOutputStandard o)
        {
            o.Albedo = _Color.rgb;
            o.Metallic = 0;
            o.Smoothness = _Glossiness;
        }
        ENDCG
    }
    FallBack "Diffuse"
}
