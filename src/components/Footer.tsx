import React from "react";
import { Zap, Palette, Code2, Flame, Waves } from "lucide-react";
import "./Footer.css";

const Footer: React.FC = () => {
  return (
  <>
    {/* Barre de délimitation */}
    <div className="relative z-10 w-full h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent"></div>

    <footer className="relative z-10 bg-black text-gray-300 py-8 mt-0">
      <div className="container mx-auto px-6 max-w-6xl">
        {/* Section principale */}
        <div className="flex justify-center mb-8">

          {/* Technologies utilisées */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4 text-center">Construit avec</h3>
            <div className="space-y-2 text-sm">
              <a
                href="https://react.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="2" />
                  <path d="M12 1a11 11 0 0 0 0 22 11 11 0 0 0 0-22zm0 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />
                  <ellipse cx="12" cy="12" rx="11" ry="4" fill="none" stroke="currentColor" strokeWidth="1" />
                  <ellipse cx="12" cy="12" rx="11" ry="4" fill="none" stroke="currentColor" strokeWidth="1" transform="rotate(60 12 12)" />
                  <ellipse cx="12" cy="12" rx="11" ry="4" fill="none" stroke="currentColor" strokeWidth="1" transform="rotate(120 12 12)" />
                </svg>
                <span>React 18</span>
              </a>
              <a
                href="https://www.typescriptlang.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Code2 className="w-5 h-5 text-blue-500" />
                <span>TypeScript</span>
              </a>
              <a
                href="https://tailwindcss.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Palette className="w-5 h-5 text-cyan-400" />
                <span>Tailwind CSS</span>
              </a>
              <a
                href="https://vitejs.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Zap className="w-5 h-5 text-yellow-400" />
                <span>Vite</span>
              </a>
              <a
                href="https://www.framer.com/motion/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Waves className="w-5 h-5 text-purple-400" />
                <span>Framer Motion</span>
              </a>
              <a
                href="https://www.mysql.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Flame className="w-5 h-5 text-orange-400" />
                <span>MySQL</span>
              </a>
              <a
                href="https://expressjs.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Zap className="w-5 h-5 text-green-400" />
                <span>Express</span>
              </a>
              <a
                href="https://www.python.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <svg className="w-5 h-5 text-yellow-300" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.914 0C5.82 0 6.2 2.656 6.2 2.656l.007 2.752h5.814v.826H3.9S0 5.789 0 11.969c0 6.18 3.403 5.96 3.403 5.96h2.03v-2.867s-.109-3.42 3.35-3.42h5.766s3.24.052 3.24-3.148V3.202S18.28 0 11.914 0zM8.708 1.85a1.06 1.06 0 1 1 0 2.12 1.06 1.06 0 0 1 0-2.12z" />
                  <path d="M12.086 24c6.094 0 5.714-2.656 5.714-2.656l-.007-2.752h-5.814v-.826h8.123S24 18.211 24 12.031c0-6.18-3.403-5.96-3.403-5.96h-2.03v2.867s.109 3.42-3.35 3.42H9.451s-3.24-.052-3.24 3.148v5.292S5.72 24 12.086 24zm3.206-1.85a1.06 1.06 0 1 1 0-2.12 1.06 1.06 0 0 1 0 2.12z" />
                </svg>
                <span>Python</span>
              </a>
              <a
                href="https://www.rust-lang.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Code2 className="w-5 h-5 text-orange-300" />
                <span>Rust</span>
              </a>
              <a
                href="https://redis.io/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10.5 2.661l.54.997-1.797.644 2.409.166.54.997-1.797.644 2.409.166.002.009L24 10.064 12 14.994 0 10.064l5.572-2.287 2.409.166.54.997-1.797.644 2.409.166.54.997zm1.5 13.833L24 12.164v3.5L12 19.994 0 15.664v-3.5l12 4.33zm0 5.5L24 17.664v3.5L12 25.494 0 21.164v-3.5l12 4.33z" />
                </svg>
                <span>Redis</span>
              </a>
            </div>
          </div>
        </div>

        {/* Ligne de séparation */}
        <div className="border-t border-gray-800 pt-6">
          <div className="text-center text-sm text-gray-500">
            <p>© {new Date().getFullYear()} LKS TV — Tous droits réservés.</p>
            <p className="mt-1">
              Créé par{" "}
              <span className="text-white font-medium">Ruben Lukusa</span>
              {" "}& son acolyte{" "}
              <span className="text-white font-medium">Claude</span>.
            </p>
            <p className="mt-1 text-gray-600 text-xs italic">
              Et si t'es pas content, on saute ton compte.
            </p>
          </div>
        </div>
      </div>
    </footer>
  </>
  );
};

export default Footer;
