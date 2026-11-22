//! Monitor labels ("Left", "Center", ...), ported from displayLayout.ts.

use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Debug)]
pub struct DisplayLike {
    pub id: u32,
    pub bounds: Bounds,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabeledDisplay {
    pub id: u32,
    pub short_label: String,
    pub label: String,
    pub primary: bool,
    pub bounds: Bounds,
}

fn axis_names(count: usize, col: bool) -> Vec<String> {
    let known: Option<&[&str]> = if col {
        match count {
            1 => Some(&["Center"]),
            2 => Some(&["Left", "Right"]),
            3 => Some(&["Left", "Center", "Right"]),
            4 => Some(&["Far left", "Left", "Right", "Far right"]),
            5 => Some(&["Far left", "Left", "Center", "Right", "Far right"]),
            _ => None,
        }
    } else {
        match count {
            1 => Some(&[""]),
            2 => Some(&["Top", "Bottom"]),
            3 => Some(&["Top", "Middle", "Bottom"]),
            4 => Some(&["Top", "Upper", "Lower", "Bottom"]),
            _ => None,
        }
    };
    if let Some(k) = known {
        return k.iter().map(|s| s.to_string()).collect();
    }
    (0..count)
        .map(|i| {
            if i == 0 {
                if col { "Left" } else { "Top" }.to_string()
            } else if i == count - 1 {
                if col { "Right" } else { "Bottom" }.to_string()
            } else if col {
                format!("Center {i}")
            } else {
                format!("Middle {i}")
            }
        })
        .collect()
}

fn cluster_centers(values: &[f64], max_gap: f64) -> Vec<f64> {
    if values.is_empty() {
        return vec![];
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut groups: Vec<Vec<f64>> = vec![vec![sorted[0]]];
    for v in sorted.into_iter().skip(1) {
        let g = groups.last_mut().unwrap();
        if v - *g.last().unwrap() <= max_gap {
            g.push(v);
        } else {
            groups.push(vec![v]);
        }
    }
    groups.iter().map(|g| g.iter().sum::<f64>() / g.len() as f64).collect()
}

fn nearest(v: f64, centers: &[f64]) -> usize {
    let mut best = 0;
    let mut dist = f64::INFINITY;
    for (i, c) in centers.iter().enumerate() {
        let d = (v - c).abs();
        if d < dist {
            dist = d;
            best = i;
        }
    }
    best
}

fn combine(row: &str, col: &str, rows: usize, cols: usize) -> String {
    if rows <= 1 {
        return if col.is_empty() { "Center".into() } else { col.into() };
    }
    if cols <= 1 {
        return if row.is_empty() { "Middle".into() } else { row.into() };
    }
    format!("{row} {}", col.to_lowercase()).trim().to_string()
}

pub fn label_displays(displays: &[DisplayLike], primary_id: Option<u32>) -> Vec<LabeledDisplay> {
    if displays.is_empty() {
        return vec![];
    }
    let cx: Vec<f64> = displays.iter().map(|d| d.bounds.x as f64 + d.bounds.width as f64 / 2.0).collect();
    let cy: Vec<f64> = displays.iter().map(|d| d.bounds.y as f64 + d.bounds.height as f64 / 2.0).collect();
    let min_w = displays.iter().map(|d| d.bounds.width).min().unwrap() as f64;
    let min_h = displays.iter().map(|d| d.bounds.height).min().unwrap() as f64;
    let cols = cluster_centers(&cx, (min_w * 0.45).max(160.0));
    let rows = cluster_centers(&cy, (min_h * 0.45).max(120.0));
    let col_names = axis_names(cols.len(), true);
    let row_names = axis_names(rows.len(), false);

    let mut out: Vec<LabeledDisplay> = displays
        .iter()
        .enumerate()
        .map(|(i, d)| {
            let c = nearest(cx[i], &cols);
            let r = nearest(cy[i], &rows);
            let short = if displays.len() == 1 {
                "This screen".to_string()
            } else {
                combine(
                    row_names.get(r).map(String::as_str).unwrap_or(""),
                    col_names.get(c).map(String::as_str).unwrap_or("Center"),
                    rows.len(),
                    cols.len(),
                )
            };
            let primary = primary_id == Some(d.id);
            let res = format!("{}×{}", d.bounds.width, d.bounds.height);
            let label = if primary { format!("{short} — {res} · main") } else { format!("{short} — {res}") };
            LabeledDisplay { id: d.id, short_label: short, label, primary, bounds: d.bounds }
        })
        .collect();
    out.sort_by(|a, b| a.bounds.y.cmp(&b.bounds.y).then(a.bounds.x.cmp(&b.bounds.x)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(id: u32, x: i32) -> DisplayLike {
        DisplayLike { id, bounds: Bounds { x, y: 0, width: 1920, height: 1080 } }
    }

    #[test]
    fn single_screen() {
        let l = label_displays(&[d(1, 0)], Some(1));
        assert_eq!(l[0].short_label, "This screen");
        assert_eq!(l[0].label, "This screen — 1920×1080 · main");
    }

    #[test]
    fn two_side_by_side() {
        let l = label_displays(&[d(2, 1920), d(1, 0)], Some(1));
        assert_eq!(l[0].short_label, "Left");
        assert_eq!(l[1].short_label, "Right");
    }
}
