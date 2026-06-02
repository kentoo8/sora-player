export function formatProgress(current, total, width = 24) {
  const ratio = total === 0 ? 1 : current / total;
  const filled = Math.round(ratio * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${current}/${total}`;
}

export function createProgressReporter(label, stream = process.stdout) {
  return ({ current, total, id }) => {
    const line = `${label} ${formatProgress(current, total)} ${id}`;
    if (stream.isTTY) {
      stream.write(`\r${line}`);
      if (current === total) stream.write('\n');
    } else {
      stream.write(`${line}\n`);
    }
  };
}
