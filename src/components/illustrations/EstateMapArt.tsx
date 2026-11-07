/** Decorative estate map from the design canvas (sign-in). Fictional: no real data. */
export function EstateMapArt() {
  return (
    <svg
      className="base"
      viewBox="80 100 1060 700"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id="si-hatch"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="8" stroke="#16202B" strokeWidth="2" />
        </pattern>
        <radialGradient id="si-heat5">
          <stop offset="0" stopColor="#F2384B" stopOpacity=".55" />
          <stop offset="1" stopColor="#F2384B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="si-heat4">
          <stop offset="0" stopColor="#FF8F2E" stopOpacity=".42" />
          <stop offset="1" stopColor="#FF8F2E" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="si-heat3">
          <stop offset="0" stopColor="#F7D046" stopOpacity=".30" />
          <stop offset="1" stopColor="#F7D046" stopOpacity="0" />
        </radialGradient>
        <marker
          id="si-aiarrow"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 Z" fill="#A88BFF" />
        </marker>
        <marker
          id="si-bluearrow"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 Z" fill="#7A9BFF" />
        </marker>
      </defs>
      <rect x="-400" y="-400" width="2000" height="1700" fill="#0C0F14" />
      <path
        d="M-400 -400 H1600 V96 C1500 104 1420 88 1300 98 C1180 108 1100 92 1000 104 C880 118 780 96 660 110 C540 124 420 98 300 114 C200 126 100 104 -20 118 C-200 128 -300 110 -400 116 Z"
        fill="#0A1520"
      />
      <path
        d="M-400 116 C-300 110 -200 128 -20 118 C100 104 200 126 300 114 C420 98 540 124 660 110 C780 96 880 118 1000 104 C1100 92 1180 108 1300 98 C1420 88 1500 104 1600 96"
        fill="none"
        stroke="#163049"
        strokeWidth="1.5"
      />
      <path d="M120 40 h60 M200 40 h30" stroke="#11253A" strokeWidth="2" strokeLinecap="round" />
      <path d="M520 60 h60 M600 60 h30" stroke="#11253A" strokeWidth="2" strokeLinecap="round" />
      <path d="M860 30 h60 M940 30 h30" stroke="#11253A" strokeWidth="2" strokeLinecap="round" />
      <path d="M300 74 h60 M380 74 h30" stroke="#11253A" strokeWidth="2" strokeLinecap="round" />
      <path d="M1040 52 h60 M1120 52 h30" stroke="#11253A" strokeWidth="2" strokeLinecap="round" />
      <path d="M-400 742 H1600" stroke="#171C26" strokeWidth="24" />
      <path d="M-400 742 H1600" stroke="#2A3142" strokeWidth="1.2" strokeDasharray="12 12" />
      <path d="M-400 812 H1600" stroke="#161B24" strokeWidth="30" />
      <path
        d="M-400 806 H1600 M-400 818 H1600"
        stroke="#262D3C"
        strokeWidth="1"
        strokeDasharray="16 10"
      />
      <path d="M1108 420 L1600 432" stroke="#171C26" strokeWidth="14" />
      <path d="M300 700 L300 742" stroke="#1A1F2A" strokeWidth="14" />
      <path d="M620 148 L620 104" stroke="#1F2633" strokeWidth="10" />
      <path
        d="M110 160 L380 150 L620 148 L860 152 L1090 170 L1110 420 L1100 700 L700 705 L110 700 Z"
        fill="#10141B"
      />
      <path
        d="M760 152 L860 152 L1090 170 L1110 420 L1100 700 L760 702 Z"
        fill="#FF8F2E"
        fillOpacity=".045"
      />
      <path
        d="M142 190 L380 181 L620 179 L860 183 L1062 200 L1078 420 L1070 670 L700 674 L142 670 Z"
        fill="none"
        stroke="#1A1F2A"
        strokeWidth="10"
        strokeLinejoin="round"
      />
      <path d="M300 700 L300 181" stroke="#1A1F2A" strokeWidth="9" strokeLinecap="round" />
      <path d="M142 420 L1110 420" stroke="#1A1F2A" strokeWidth="9" strokeLinecap="round" />
      <path d="M760 183 L760 674" stroke="#1A1F2A" strokeWidth="9" strokeLinecap="round" />
      <path d="M300 548 L1070 548" stroke="#1A1F2A" strokeWidth="9" strokeLinecap="round" />
      <path d="M300 276 L760 276" stroke="#1A1F2A" strokeWidth="9" strokeLinecap="round" />
      <rect x="336" y="290" width="172" height="104" rx="4" fill="#0F1A16" stroke="#17291F" />
      <circle cx="360" cy="318" r="7" fill="#132219" />
      <circle cx="392" cy="352" r="7" fill="#132219" />
      <circle cx="430" cy="320" r="7" fill="#132219" />
      <circle cx="470" cy="362" r="7" fill="#132219" />
      <circle cx="408" cy="378" r="7" fill="#132219" />
      <circle cx="486" cy="312" r="7" fill="#132219" />
      <rect x="520" y="446" width="214" height="82" rx="4" fill="#151A24" stroke="#232A38" />
      <rect x="168" y="560" width="104" height="82" rx="4" fill="#141820" stroke="#1E2430" />
      <rect x="930" y="300" width="112" height="104" rx="4" fill="#141820" stroke="#1E2430" />
      <rect x="790" y="300" width="124" height="104" rx="4" fill="#131821" stroke="#1C2230" />
      <rect x="520" y="584" width="214" height="62" rx="4" fill="#131821" stroke="#1C2230" />
      <rect x="168" y="214" width="104" height="74" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="168" y="306" width="104" height="84" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="168" y="452" width="104" height="80" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="336" y="212" width="110" height="52" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="464" y="210" width="118" height="52" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="600" y="210" width="132" height="52" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="528" y="290" width="96" height="96" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="640" y="290" width="92" height="96" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="336" y="448" width="156" height="68" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="336" y="584" width="156" height="62" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="790" y="214" width="124" height="64" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="930" y="212" width="112" height="64" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="790" y="446" width="126" height="78" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="930" y="446" width="124" height="78" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="790" y="580" width="126" height="64" rx="3" fill="#161B25" stroke="#242B39" />
      <rect x="930" y="580" width="124" height="64" rx="3" fill="#161B25" stroke="#242B39" />
      <path
        d="M110 160 L380 150 L620 148 L860 152 L1090 170 L1110 420 L1100 700 L700 705 L110 700 Z"
        fill="none"
        stroke="#3B4458"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M300 150 V702"
        stroke="#5E708A"
        strokeOpacity=".5"
        strokeWidth="1.2"
        strokeDasharray="3 7"
      />
      <path
        d="M760 150 V702"
        stroke="#5E708A"
        strokeOpacity=".5"
        strokeWidth="1.2"
        strokeDasharray="3 7"
      />
      <rect
        x="291"
        y="691"
        width="18"
        height="18"
        rx="3"
        fill="#0A0C10"
        stroke="#AAB2C4"
        strokeWidth="1.6"
      />
      <text
        x="300"
        y="704"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.5"
        fill="#E9EDF5"
      >
        A
      </text>
      <rect
        x="611"
        y="139"
        width="18"
        height="18"
        rx="3"
        fill="#0A0C10"
        stroke="#AAB2C4"
        strokeWidth="1.6"
      />
      <text
        x="620"
        y="152"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.5"
        fill="#E9EDF5"
      >
        B
      </text>
      <rect
        x="1099"
        y="411"
        width="18"
        height="18"
        rx="3"
        fill="#0A0C10"
        stroke="#AAB2C4"
        strokeWidth="1.6"
      />
      <text
        x="1108"
        y="424"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.5"
        fill="#E9EDF5"
      >
        C
      </text>
      <polyline
        points="142,190 380,181 620,179 860,183 1062,200"
        fill="none"
        stroke="#7A9BFF"
        strokeOpacity=".75"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <polyline
        points="142,670 300,670 700,674 1070,670"
        fill="none"
        stroke="#7A9BFF"
        strokeOpacity=".45"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="142" cy="190" r="5.5" fill="#35C77B" stroke="#0A0C10" strokeWidth="2.0" />
      <circle cx="380" cy="181" r="5.5" fill="#35C77B" stroke="#0A0C10" strokeWidth="2.0" />
      <circle cx="620" cy="179" r="5.5" fill="#35C77B" stroke="#0A0C10" strokeWidth="2.0" />
      <circle
        cx="860"
        cy="183"
        r="12.0"
        fill="none"
        stroke="#E9EDF5"
        strokeOpacity=".35"
        strokeWidth="1.5"
      />
      <circle cx="860" cy="183" r="6.5" fill="#E9EDF5" stroke="#0A0C10" strokeWidth="2.0" />
      <circle cx="1062" cy="200" r="5.5" fill="#0F1218" stroke="#8790A5" strokeWidth="1.8" />
      <circle cx="142" cy="670" r="5.5" fill="#35C77B" stroke="#0A0C10" strokeWidth="2.0" />
      <circle cx="300" cy="670" r="5.5" fill="#35C77B" stroke="#0A0C10" strokeWidth="2.0" />
      <circle cx="700" cy="674" r="6.0" fill="#F2384B" stroke="#0A0C10" strokeWidth="2.0" />
      <circle cx="1070" cy="670" r="5.5" fill="#0F1218" stroke="#8790A5" strokeWidth="1.8" />
      <circle cx="1050" cy="414" r="12.5" fill="#3462F0" stroke="#0A0C10" strokeWidth="2.2" />
      <text
        x="1050"
        y="417.8"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.0"
        fill="#FFFFFF"
      >
        MB
      </text>
      <circle cx="858" cy="336" r="12.5" fill="#3462F0" stroke="#0A0C10" strokeWidth="2.2" />
      <text
        x="858"
        y="339.8"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.0"
        fill="#FFFFFF"
      >
        TB
      </text>
      <circle cx="962" cy="470" r="12.5" fill="#3462F0" stroke="#0A0C10" strokeWidth="2.2" />
      <text
        x="962"
        y="473.8"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.0"
        fill="#FFFFFF"
      >
        AL
      </text>
      <circle cx="514" cy="186" r="12.5" fill="#3462F0" stroke="#0A0C10" strokeWidth="2.2" />
      <text
        x="514"
        y="189.8"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.0"
        fill="#FFFFFF"
      >
        YG
      </text>
      <circle cx="884" cy="672" r="12.5" fill="#3462F0" stroke="#0A0C10" strokeWidth="2.2" />
      <text
        x="884"
        y="675.8"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.0"
        fill="#FFFFFF"
      >
        IO
      </text>
      <circle cx="470" cy="420" r="12.5" fill="#3462F0" stroke="#0A0C10" strokeWidth="2.2" />
      <text
        x="470"
        y="423.8"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.0"
        fill="#FFFFFF"
      >
        BO
      </text>
      <circle cx="300" cy="662" r="12.5" fill="#3462F0" stroke="#0A0C10" strokeWidth="2.2" />
      <text
        x="300"
        y="665.8"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.0"
        fill="#FFFFFF"
      >
        SO
      </text>
      <circle cx="640" cy="470" r="12.5" fill="#3462F0" stroke="#0A0C10" strokeWidth="2.2" />
      <text
        x="640"
        y="473.8"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.0"
        fill="#FFFFFF"
      >
        GE
      </text>
      <circle cx="444" cy="600" r="12.5" fill="#3462F0" stroke="#0A0C10" strokeWidth="2.2" />
      <text
        x="444"
        y="603.8"
        textAnchor="middle"
        fontFamily="Archivo, Helvetica, Arial, sans-serif"
        fontWeight="700"
        fontSize="10.0"
        fill="#FFFFFF"
      >
        EN
      </text>
    </svg>
  );
}
