const { execFileSync } = require("child_process");
const PDFTOTEXT = "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe";
const p = "C:\\Users\\admin\\Desktop\\India Related Reports\\Indian Real Estate\\[260601] [Nomura] India real estate round-up - 1QFY27F � Resilient start.pdf";
try{
  const buf = execFileSync(PDFTOTEXT, ["-layout", "-f", "1", "-l", "10", "--", p, "-"], { maxBuffer: 12*1024*1024 });
  console.log("Bytes:", buf.length);
  console.log("First 800 chars:");
  console.log(buf.toString("utf8").slice(0,800));
} catch(e){
  console.log("ERROR:", e.message);
}
