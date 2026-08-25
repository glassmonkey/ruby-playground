class CreateSnippets < ActiveRecord::Migration[8.1]
  def change
    create_table :snippets do |t|
      t.string :title, null: false
      t.text :code, null: false
      t.references :user, null: false, foreign_key: true

      t.timestamps
    end
  end
end
