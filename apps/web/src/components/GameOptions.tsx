import type { GameOptionDefinition, GameOptionValues } from '@bgx/protocol';

/** 根据选项定义生成默认值；multi 选项返回新数组，避免共享可变引用。 */
export function defaultOptionValues(defs: readonly GameOptionDefinition[]): GameOptionValues {
  return Object.fromEntries(
    defs.map((def) => [def.id, Array.isArray(def.default) ? [...def.default] : def.default]),
  );
}

interface GameOptionsProps {
  definitions: readonly GameOptionDefinition[];
  values: GameOptionValues;
  disabled?: boolean;
  onChange: (patch: GameOptionValues) => void;
}

/** 通用的开局选项编辑器：框架渲染，不包含任何具体游戏规则。 */
export function GameOptions({ definitions, values, disabled, onChange }: GameOptionsProps) {
  if (definitions.length === 0) return null;

  return (
    <div className="game-options">
      {definitions.map((def) => {
        const value = values[def.id] ?? def.default;
        const isMulti = def.type === 'multi';
        const selected = Array.isArray(value) ? value : value ? [value] : [];
        const description = isMulti
          ? def.description
          : def.choices.find((choice) => choice.value === value)?.description;

        return (
          <div className="option-row" key={def.id}>
            <label className="option-label" htmlFor={`option-${def.id}`}>
              {def.label}
            </label>
            {isMulti ? (
              <div className="option-choices" id={`option-${def.id}`}>
                {def.choices.map((choice) => {
                  const checked = selected.includes(choice.value);
                  return (
                    <label
                      className={`option-check${choice.disabled && !checked ? ' option-check-disabled' : ''}`}
                      key={choice.value}
                      title={choice.disabled ? choice.description : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || (choice.disabled && !checked)}
                        onChange={() => {
                          const next = checked
                            ? selected.filter((item) => item !== choice.value)
                            : [...selected, choice.value];
                          onChange({ [def.id]: next });
                        }}
                      />
                      <span>{choice.label}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <select
                id={`option-${def.id}`}
                className="option-select"
                value={typeof value === 'string' ? value : ''}
                disabled={disabled}
                onChange={(event) => onChange({ [def.id]: event.target.value })}
              >
                {def.choices.map((choice) => (
                  <option
                    value={choice.value}
                    key={choice.value}
                    disabled={choice.disabled && choice.value !== value}
                  >
                    {choice.label}
                  </option>
                ))}
              </select>
            )}
            {(description ?? def.description) && (
              <p className="option-desc">{description ?? def.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
