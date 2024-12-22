/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites(){
    return [
      {
        source: '/:any*',
        destination: '/',
      },
    ];
  },
};

export default nextConfig;
