// Built-in render pipeline: lit surface coloured by mesh vertex colours.
Shader "Yunshan/VertexColorLit"
{
    Properties
    {
        _Glossiness ("Smoothness", Range(0,1)) = 0.12
        _Emission ("Night glow", Range(0,2)) = 0
        _EmissionTint ("Glow tint", Color) = (1, 0.82, 0.55, 1)
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        LOD 200
        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows vertex:vert addshadow
        #pragma target 3.0
        struct Input { float4 color : COLOR; };
        half _Glossiness;
        half _Emission;
        fixed4 _EmissionTint;
        void vert (inout appdata_full v, out Input o)
        {
            UNITY_INITIALIZE_OUTPUT(Input, o);
            o.color = v.color;
        }
        void surf (Input IN, inout SurfaceOutputStandard o)
        {
            o.Albedo = IN.color.rgb;
            o.Metallic = 0;
            o.Smoothness = _Glossiness;
            o.Emission = IN.color.rgb * _EmissionTint.rgb * _Emission;
        }
        ENDCG
    }
    FallBack "Diffuse"
}
