/**
 * @fileoverview 改动统计
 * @description 计算两段文本之间增删的行数，diff 的显示由 Monaco 负责
 * @module diff
 */

const toLines = text => {
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
};

/**
 * Myers 算法，只求编辑距离
 * @private
 */
function editDistance(a, b, limit = 4000) {
    const max = Math.min(a.length + b.length, limit);
    const offset = max + 1;
    const furthest = new Int32Array(2 * max + 3);

    for (let d = 0; d <= max; d++) {
        for (let k = -d; k <= d; k += 2) {
            const goDown = k === -d || (k !== d && furthest[offset + k - 1] < furthest[offset + k + 1]);
            let x = goDown ? furthest[offset + k + 1] : furthest[offset + k - 1] + 1;
            let y = x - k;
            while (x < a.length && y < b.length && a[x] === b[y]) {
                x++;
                y++;
            }
            furthest[offset + k] = x;
            if (x >= a.length && y >= b.length) return d;
        }
    }
    return a.length + b.length;
}

/**
 * 统计增删行数
 * @param {string} before - 改动前（LF 换行）
 * @param {string} after - 改动后（LF 换行）
 * @returns {{added: number, removed: number}}
 */
export function countChanges(before, after) {
    const a = toLines(before);
    const b = toLines(after);

    let start = 0;
    let endA = a.length;
    let endB = b.length;
    while (start < endA && start < endB && a[start] === b[start]) start++;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }

    const middleA = a.slice(start, endA);
    const middleB = b.slice(start, endB);
    const distance = editDistance(middleA, middleB);
    const common = (middleA.length + middleB.length - distance) / 2;
    return { added: middleB.length - common, removed: middleA.length - common };
}
