type SongSelectorProps = {
  songs: string[];
  value: string;
  onChange: (songId: string) => void;
};

export function SongSelector({ songs, value, onChange }: SongSelectorProps) {
  return (
    <label>
      Song
      <select aria-label="Song" value={value} onChange={(event) => onChange(event.target.value)}>
        {songs.map((songId) => (
          <option key={songId} value={songId}>
            {songId}
          </option>
        ))}
      </select>
    </label>
  );
}
